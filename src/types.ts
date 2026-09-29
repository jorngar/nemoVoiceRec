export type Turn = {
  start: number;
  end: number;
  speaker: string;
  text: string;
};
export type Recording = {
  id: string;
  title: string;
  createdAt: string;
  duration: number;
  peaks: number[];
  favorite: boolean;
  deleted: boolean;
  turns: Turn[];
  speakers: Record<string, string>;
  activity?: Omit<Turn, "text">[];
  transcribed?: boolean;
  language?: string;
  languageDetected?: boolean;
  summary?: Summary;
  demo?: boolean;
};
export type Progress = {
  id?: string;
  message: string;
  done?: number;
  total?: number;
  turns?: Turn[];
  started?: number;
};
export type Summary = {
  text: string;
  language: string;
  createdAt: string;
  speakers: Record<string, string>;
};
export type MenuAction =
  | "copy-transcript"
  | "download-docx"
  | "copy-summary"
  | "favorite"
  | "export-audio"
  | "delete";
export type Settings = {
  enginePath: string;
  modelPath: string;
  language?: string;
  hermesPath?: string;
  summaryLanguage?: string;
};
export interface Bridge {
  list(): Promise<Recording[]>;
  save(item: Recording, audio: ArrayBuffer): Promise<Recording>;
  update(id: string, changes: Partial<Recording>): Promise<Recording>;
  audio(id: string): Promise<Uint8Array>;
  audioUrl?(id: string): string;
  importFile?(file: File, title: string): Promise<Recording | null>;
  export(
    id: string,
    kind: string,
    data?: string | Uint8Array,
  ): Promise<boolean>;
  showMenu?(id: string): Promise<void>;
  onMenuAction?(
    fn: (choice: { id: string; action: MenuAction }) => void,
  ): () => void;
  settings(): Promise<Settings>;
  pickSetting(key: string): Promise<Settings | null>;
  setLanguage?(language: string): Promise<Settings>;
  languages?(): Promise<string[]>;
  setSummaryLanguage?(language: string): Promise<Settings>;
  summarize?(id: string): Promise<Recording>;
  cancelSummary?(): Promise<void>;
  status(): Promise<{ ready: boolean }>;
  transcribe(id: string): Promise<Recording>;
  cancel(): Promise<void>;
  recording(value: boolean): Promise<void>;
  microphone(): Promise<boolean>;
  onProgress(fn: (update: Progress) => void): () => void;
}
declare global {
  interface Window {
    voices?: Bridge;
  }
}
