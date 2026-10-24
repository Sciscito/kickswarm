// The local engine's providers (OSP v0.4 §2.6): every AI access a contributor may automate, through
// its official API, with their own key. Consumer chat websites and apps are NOT here: their terms
// forbid driving them, and they stay with the chat door, by hand (§2.3).

export type TypeApi = 'openai' | 'anthropic';

export interface Fournisseur {
  id: string;
  api: TypeApi;
  /** Base URL of the API (OpenAI-compatible: the one ending in /v1 or equivalent). */
  url: string;
  cle?: string;
  /** A free tier or a local model: no money is spent. */
  gratuit: boolean;
  /** Its terms say prompts are not used to train models (local models, most paid APIs). */
  confidentiel: boolean;
  /** How its models are found: OpenRouter's zero-price models, the provider's /models list, or a fixed list. */
  decouverte: 'openrouter-gratuits' | 'liste' | 'aucune';
  modeles?: string[];
  /** Requests per day for this key, when the contributor knows it (the engine also learns from refusals). */
  parJour?: number;
  /** A server on this machine: unlimited and private, used as the fallback. */
  local?: boolean;
}

export interface EntreeCatalogue extends Omit<Fournisseur, 'cle'> {
  /** The environment variable that may hold the key. */
  env?: string;
  aide: string;
}

/** The providers the engine knows. Their free tiers and terms change: check them, and mark them yourself. */
export const CATALOGUE: Record<string, EntreeCatalogue> = {
  openrouter: { id: 'openrouter', api: 'openai', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', gratuit: true, confidentiel: false, decouverte: 'openrouter-gratuits', aide: 'OpenRouter: every zero-price model, test models included, found automatically' },
  gemini: { id: 'gemini', api: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', gratuit: true, confidentiel: false, decouverte: 'liste', aide: 'Google Gemini API, free tier' },
  groq: { id: 'groq', api: 'openai', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', gratuit: true, confidentiel: false, decouverte: 'liste', aide: 'Groq, free tier' },
  mistral: { id: 'mistral', api: 'openai', url: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY', gratuit: true, confidentiel: false, decouverte: 'liste', aide: 'Mistral La Plateforme, free plan' },
  ollama: { id: 'ollama', api: 'openai', url: 'http://127.0.0.1:11434/v1', gratuit: true, confidentiel: true, decouverte: 'liste', local: true, aide: 'Ollama, models on this machine' },
  lmstudio: { id: 'lmstudio', api: 'openai', url: 'http://127.0.0.1:1234/v1', gratuit: true, confidentiel: true, decouverte: 'liste', local: true, aide: 'LM Studio, models on this machine' },
  openai: { id: 'openai', api: 'openai', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', gratuit: false, confidentiel: true, decouverte: 'aucune', aide: 'OpenAI API, paid: name the models, and set a budget' },
  anthropic: { id: 'anthropic', api: 'anthropic', url: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY', gratuit: false, confidentiel: true, decouverte: 'aucune', aide: 'Anthropic API, paid: name the models, and set a budget' },
};

export interface Modele {
  /** `<provider>/<model>`, as results declare it (agent.modele) and the leaderboard shows it. */
  id: string;
  fournisseur: string;
  /** The model's name at the provider. */
  nom: string;
  /** Context size in tokens. */
  contexte: number;
  gratuit: boolean;
  confidentiel: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A refusal from a provider, with what the pool should do about it. */
export class ErreurFournisseur extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Wait at least this long before trying this model again. */
    readonly attendreMs?: number,
    /** The key or the model will not work today (bad key, no credit, unknown model). */
    readonly definitif = false,
  ) {
    super(message);
  }
}

const CONTEXTE_PAR_DEFAUT = 32_768;
const NON_TEXTE = /embed|whisper|tts|audio|image|vision-preview|moderation|guard|rerank|transcri|speech|dall-e/i;

function entetes(f: Fournisseur): Record<string, string> {
  if (f.api === 'anthropic') return { 'content-type': 'application/json', 'x-api-key': f.cle ?? '', 'anthropic-version': '2023-06-01' };
  return { 'content-type': 'application/json', ...(f.cle ? { authorization: `Bearer ${f.cle}` } : {}), ...(f.id === 'openrouter' ? { 'x-title': 'Kickswarm' } : {}) };
}

/** "1m30s", "2.5s", "120" (seconds), or an HTTP date: a wait in ms. */
export function duree(valeur: string | null | undefined): number | undefined {
  if (!valeur) return undefined;
  const v = valeur.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(v);
  if (m && m[0]) return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0);
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Turns a provider's refusal into what the pool must know. */
export async function refus(res: Response): Promise<ErreurFournisseur> {
  const texte = (await res.text().catch(() => '')).slice(0, 300);
  const attendre = duree(res.headers.get('retry-after')) ?? duree(res.headers.get('x-ratelimit-reset-requests')) ?? duree(res.headers.get('x-ratelimit-reset'));
  const definitif = res.status === 401 || res.status === 403 || res.status === 402 || res.status === 404;
  return new ErreurFournisseur(`${res.status} ${texte}`, res.status, attendre, definitif);
}

/** The models a provider offers, for the pool. */
export async function decouvrir(f: Fournisseur): Promise<Modele[]> {
  const fait = (nom: string, contexte?: number): Modele => ({ id: `${f.id}/${nom}`, fournisseur: f.id, nom, contexte: contexte ?? CONTEXTE_PAR_DEFAUT, gratuit: f.gratuit, confidentiel: f.confidentiel });
  if (f.decouverte === 'aucune' || f.modeles?.length) return (f.modeles ?? []).map((m) => fait(m));
  const res = await fetch(`${f.url}/models`, { headers: entetes(f), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw await refus(res);
  const data = ((await res.json()) as { data?: Array<{ id: string; context_length?: number; context_window?: number; pricing?: { prompt?: string; completion?: string } }> }).data ?? [];
  if (f.decouverte === 'openrouter-gratuits') {
    // Every model whose price is zero, test models included; a model that stops being free disappears.
    return data
      .filter((m) => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && m.pricing.prompt !== undefined && !NON_TEXTE.test(m.id))
      .map((m) => fait(m.id, m.context_length));
  }
  return data.filter((m) => !NON_TEXTE.test(m.id)).map((m) => fait(m.id, m.context_length ?? m.context_window));
}

/** The raw request to a provider (OpenAI-compatible): the personal endpoint passes it through. */
export function requeteBrute(f: Fournisseur, corps: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch(`${f.url}/chat/completions`, { method: 'POST', headers: entetes(f), body: JSON.stringify(corps), ...(signal ? { signal } : {}) });
}

/** One completion. Throws ErreurFournisseur on a refusal. */
export async function completer(f: Fournisseur, nom: string, messages: Message[], o: { maxTokens: number; signal?: AbortSignal }): Promise<string> {
  const signal = o.signal ?? AbortSignal.timeout(180_000);
  if (f.api === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await fetch(`${f.url}/messages`, {
      method: 'POST',
      headers: entetes(f),
      body: JSON.stringify({ model: nom, max_tokens: o.maxTokens, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system') }),
      signal,
    });
    if (!res.ok) throw await refus(res);
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
  const res = await requeteBrute(f, { model: nom, messages, max_tokens: o.maxTokens, temperature: 0.2 }, signal);
  if (!res.ok) throw await refus(res);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }>; error?: { message?: string; code?: number } };
  // Some providers answer 200 with an error inside (OpenRouter, when an upstream refuses).
  if (j.error) throw new ErreurFournisseur(j.error.message ?? 'provider error', j.error.code ?? 502, j.error.code === 429 ? 60_000 : undefined);
  const texte = j.choices?.[0]?.message?.content;
  if (typeof texte !== 'string' || !texte.trim()) throw new ErreurFournisseur('empty answer', 502, 30_000);
  return texte;
}
