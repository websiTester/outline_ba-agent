export const DELIMITER = "<#>";

export function extractUserContent(toolPrompt: string): string {
  const parts = toolPrompt.split(DELIMITER);
  if (parts.length < 3) { return toolPrompt; }
  return parts[1].trim();
}

export function replaceUserContent(toolPrompt: string, newContent: string): string {
  const parts = toolPrompt.split(DELIMITER);
  if (parts.length < 3) { return newContent; }
  return `${parts[0]}${DELIMITER}\n${newContent}\n${DELIMITER}${parts[2]}`;
}

export function hasDelimiter(toolPrompt: string): boolean {
  return toolPrompt.split(DELIMITER).length >= 3;
}
