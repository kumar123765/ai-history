export type EventItem = {
  kind: "event" | "birth" | "death";
  title: string;
  year?: string;
  text?: string;
  summary?: string;
  date_iso?: string | null;
  display_date?: string | undefined;
  verified_day?: boolean;
  is_indian: boolean;
  score?: number;
  px_rank?: number;
  sources?: { wikipedia_page?: string | null };
};

export type PXItem = {
  px_rank: number;
  title: string;
  year: string;
  note: string;
};
