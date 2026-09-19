export class DuplicateDailyLogError extends Error {
  readonly date: string;

  constructor(date: string) {
    super("duplicate_date");
    this.name = "DuplicateDailyLogError";
    this.date = date;
  }
}
