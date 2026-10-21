/** Calls `onLine` for each non-empty line of a child process's output, until it ends. */
export const readLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> => {
  const decoder = new TextDecoder();
  let rest = '';

  for await (const chunk of stream) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');

    rest = lines.at(-1) ?? '';
    lines
      .slice(0, -1)
      .filter((line) => line.trim() !== '')
      .forEach(onLine);
  }
};
