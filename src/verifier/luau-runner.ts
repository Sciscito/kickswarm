// The Luau runner (OSP v0.3 §3.6), run by luau-worker.ts in the Luau virtual machine compiled to
// WebAssembly. It receives, as its arguments, a loader the host gives it (it compiles a deliverable
// file, or a property expression, as a chunk of its own) and the suite. It returns its report as its
// own return value, which the delivered code cannot reach.
//
// Like the JavaScript runner, it captures every function it needs before any delivered code runs.
// Comparing and encoding only use raw operations (rawget, rawlen, next), so a metatable cannot lie.
// Modules see the standard library (read-only, sandboxed), their own `require`, and nothing of the
// runner: no getfenv or setfenv, and `_G` is their own environment.

export const LUAU_RUNNER = String.raw`
local LOAD, SPEC = ...
local type, rawget, rawset, rawlen, rawequal, next, pcall, error, tostring, select, setmetatable, setfenv =
  type, rawget, rawset, rawlen, rawequal, next, pcall, error, tostring, select, setmetatable, setfenv
local sformat, sgsub, smatch, ssub, sbyte, sfind = string.format, string.gsub, string.match, string.sub, string.byte, string.find
local tconcat, tsort, tunpack = table.concat, table.sort, table.unpack
local ulen = utf8.len
local mhuge, mfloor = math.huge, math.floor
local G = getfenv(1)
local MAX = 64
local BLOQUES = { getfenv = true, setfenv = true, require = true }

local function msg(e)
  if type(e) == "string" then return e end
  return "error of type " .. type(e)
end

local function copie(v, d)
  if type(v) ~= "table" then return v end
  if d > MAX then error("value too deep") end
  local t = {}
  for k, x in next, v do rawset(t, k, copie(x, d + 1)) end
  return t
end

local function eq(a, b, d)
  d = d or 0
  if d > MAX then return false end
  local ta = type(a)
  if ta ~= type(b) then return false end
  if ta == "number" then return a == b or (a ~= a and b ~= b) end
  if ta ~= "table" then return rawequal(a, b) end
  for k, v in next, a do
    if not eq(v, rawget(b, k), d + 1) then return false end
  end
  for k in next, b do
    if rawget(a, k) == nil then return false end
  end
  return true
end

local ECH = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
local function echappe(c)
  return ECH[c] or sformat("\\u%04x", sbyte(c))
end

local function json(v, d, out)
  local t = type(v)
  if v == nil then
    out[#out + 1] = "null"
  elseif t == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif t == "number" then
    if v ~= v or v == mhuge or v == -mhuge then
      out[#out + 1] = "null"
    elseif v == mfloor(v) and v > -9007199254740992 and v < 9007199254740992 then
      out[#out + 1] = sformat("%d", v)
    else
      out[#out + 1] = sformat("%.17g", v)
    end
  elseif t == "string" then
    local motif = ulen(v) and '[%c"\\]' or '[%c"\\\128-\255]'
    out[#out + 1] = '"' .. sgsub(v, motif, echappe) .. '"'
  elseif t == "table" then
    if d > MAX then
      out[#out + 1] = '"<too deep>"'
      return
    end
    local n, total = rawlen(v), 0
    for _ in next, v do total += 1 end
    if n > 0 and total == n then
      out[#out + 1] = "["
      for i = 1, n do
        if i > 1 then out[#out + 1] = "," end
        json(rawget(v, i), d + 1, out)
      end
      out[#out + 1] = "]"
    else
      local cles = {}
      for k in next, v do cles[#cles + 1] = k end
      tsort(cles, function(x, y) return tostring(x) < tostring(y) end)
      out[#out + 1] = "{"
      for i, k in cles do
        if i > 1 then out[#out + 1] = "," end
        json(type(k) == "string" and k or tostring(k), d + 1, out)
        out[#out + 1] = ":"
        json(rawget(v, k), d + 1, out)
      end
      out[#out + 1] = "}"
    end
  else
    out[#out + 1] = '"<' .. t .. '>"'
  end
end

local function enc(v)
  local out = {}
  json(v, 0, out)
  return tconcat(out)
end

-- require("./Coins"), require("../shared/Types"): relative to the requiring file, as in Luau's
-- require by string. Roblox instance paths (script.Parent.X) do not exist outside Roblox.
local function resoudre(depuis, chemin)
  if type(chemin) ~= "string" then
    error("require expects a relative path, such as require(\"./Coins\"); Roblox instance paths do not exist outside Roblox", 3)
  end
  if ssub(chemin, 1, 2) ~= "./" and ssub(chemin, 1, 3) ~= "../" then
    error("require(\"" .. chemin .. "\"): use a path that starts with ./ or ../", 3)
  end
  local parties = {}
  for p in string.gmatch(smatch(depuis, "^(.*)/") or "", "[^/]+") do parties[#parties + 1] = p end
  for p in string.gmatch(chemin, "[^/]+") do
    if p == ".." then
      if #parties == 0 then error("require(\"" .. chemin .. "\") leaves the deliverable", 3) end
      parties[#parties] = nil
    elseif p ~= "." then
      parties[#parties + 1] = p
    end
  end
  return tconcat(parties, "/")
end

local cache, enCours = {}, {}
local charger

local function environnement(nom)
  local env = {}
  local proxy = setmetatable(env, {
    __index = function(_, k)
      if k == "_G" then return env end
      if BLOQUES[k] then return nil end
      return G[k]
    end,
    __metatable = false,
  })
  rawset(env, "require", function(chemin)
    return charger(resoudre(nom, chemin))
  end)
  return proxy
end

charger = function(chemin)
  local f, nom = LOAD("module", chemin)
  if not f then error(nom, 0) end
  if cache[nom] ~= nil then return cache[nom] end
  if enCours[nom] then error("cyclic require of " .. nom, 0) end
  enCours[nom] = true
  setfenv(f, environnement(nom))
  local v = f()
  enCours[nom] = nil
  if v == nil then error(nom .. " must return a value (its table of functions)", 0) end
  cache[nom] = v
  return v
end

local function appel(f, a)
  local args = copie(a.args, 0)
  return pcall(f, tunpack(args, 1, a.n))
end

local ok, M = pcall(charger, SPEC.module)
if not ok then return enc({ chargement = msg(M) }) end
if type(M) ~= "table" then return enc({ chargement = SPEC.module .. " must return a table of functions" }) end

local res = {}
local function cas(t)
  local f = rawget(M, t.fn)
  if type(f) ~= "function" then return { ok = false, erreur = "missing function " .. t.fn } end
  local bon, out = appel(f, t)
  if not bon then return { ok = false, erreur = msg(out) } end
  return { ok = eq(out, t.attendu), obtenu = enc(out) }
end
for _, t in SPEC.tests do res[#res + 1] = cas(t) end
for _, t in SPEC.caches do
  local r = cas(t)
  res[#res + 1] = { ok = r.ok }
end
for _, p in SPEC.proprietes do
  local f = rawget(M, p.fn)
  local verifie, err = LOAD("expression", p.verifie)
  if type(f) ~= "function" then
    res[#res + 1] = { ok = false, erreur = "missing function " .. p.fn }
  elseif not verifie then
    res[#res + 1] = { ok = false, erreur = "invalid property expression: " .. tostring(err) }
  else
    setfenv(verifie, environnement("property"))
    local echec = nil
    for _, c in p.cas do
      local bon, out = appel(f, c)
      if not bon then
        echec = "counterexample: " .. p.fn .. enc(c.args) .. " raised " .. msg(out)
      else
        local okv, vrai = pcall(verifie, copie(c.args, 0), out, eq)
        if not okv then
          echec = "counterexample: " .. p.fn .. enc(c.args) .. " returned " .. enc(out) .. ", and the property raised " .. msg(vrai)
        elseif not vrai then
          echec = "counterexample: " .. p.fn .. enc(c.args) .. " returned " .. enc(out)
        end
      end
      if echec then break end
    end
    res[#res + 1] = echec and { ok = false, erreur = echec } or { ok = true, cas = #p.cas }
  end
end
return enc({ resultats = res })
`;
