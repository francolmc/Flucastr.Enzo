export interface CalendarEventRow {
  id: string;
  userId: string;
  title: string;
  /** Epoch ms UTC */
  startAt: number;
  /** Epoch ms UTC or null */
  endAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CalendarInsertInput {
  title: string;
  startAt: number;
  endAt?: number | null;
  notes?: string | null;
}

export interface CalendarUpdateInput {
  title?: string;
  startAt?: number;
  endAt?: number | null;
  notes?: string | null;
}
