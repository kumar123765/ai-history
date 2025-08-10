export type Kind = "event" | "birth" | "death";

export type PXItem = {
  title: string;
  year?: string;
  note?: string;
  px_rank: number;
};

export type EventItem = {
  kind: Kind;
  title: string;
  year?: string;
  text?: string;
  pageUrl?: string | null;

  // computed/flow fields
  px_rank?: number;
  summary?: string;
  date_iso?: string | null;
  display_date?: string;
  is_indian?: boolean;
  score?: number;
  sources?: { wikipedia_page?: string | null };
};
