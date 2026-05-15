export const ALLOWED_FILE_EXTENSIONS = [
  // Text formats
  'txt', 'md', 'mdx',
  // Documents
  'docx', 'pdf', 'pptx', 'xlsx', 'rtf', 'odt', 'epub',
  // Markup & Web
  'html', 'htm', 'tex',
  // Data formats
  'json', 'xml', 'yaml', 'yml', 'csv',
  // Config files
  'log', 'conf', 'ini', 'properties',
  // Code files
  'sql', 'bat', 'sh', 'c', 'h', 'cpp', 'hpp',
  'py', 'java', 'js', 'ts', 'tsx', 'jsx',
  'swift', 'go', 'rb', 'php',
  // Stylesheets
  'css', 'scss', 'less',
] as const

export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number]

export const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

export const MAX_FILE_COUNT = Infinity

export function getAllowedFileTypesDescription(): string {
  const extensions = ALLOWED_FILE_EXTENSIONS.slice(0, 10)
  return `${[...extensions].join(', ').toUpperCase()}, and more`
}

export function isAllowedFileType(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (!extension) { return false }
  return (ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(extension)
}

export function getFileExtension(fileName: string): string | null {
  return fileName.split('.').pop()?.toLowerCase() ?? null
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) { return '0 Bytes' }
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
