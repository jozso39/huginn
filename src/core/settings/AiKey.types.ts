/** Who answers triage's model calls: Jev for sentence rules, a chat model for learned rules. */
export enum AiProvider {
  /** Jev and the rule-writing chat model, both through openrouter.ai. */
  OpenRouter = 'OpenRouter',
  /** Jev straight from TypeSafe. It has no chat model, so reasons are not turned into rules. */
  TypeSafe = 'TypeSafe',
}

/** What anyone may see about the stored key: never the key itself. */
export interface AiKeyInfo {
  readonly provider: AiProvider;
  /** Its last four characters, to tell keys apart. */
  readonly hint: string;
  readonly savedAt: Date;
}

/** The key as the model clients send it. Nothing else ever gets it. */
export interface AiCredentials {
  readonly provider: AiProvider;
  readonly apiKey: string;
}

/** Where the model clients find the key at the moment of a call; null while none is set. */
export interface IAiKeySource {
  credentials(): AiCredentials | null;
}

/** Asks the provider whether a key works, before it is saved. */
export interface IAiKeyChecker {
  check(credentials: AiCredentials): Promise<void>;
}
