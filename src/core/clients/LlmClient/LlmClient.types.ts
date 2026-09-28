export interface JsonCompletionRequest {
  readonly system: string;
  readonly user: string;
  /** A JSON Schema the answer must follow (structured output). */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly schemaName: string;
}

/** A chat model that answers with JSON matching a schema. Output is untrusted: validate it. */
export interface ILlmClient {
  completeJson(request: JsonCompletionRequest): Promise<unknown>;
  available(): boolean;
}
