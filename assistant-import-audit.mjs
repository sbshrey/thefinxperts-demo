const rupees = value => `₹${(Math.round(value * 100) / 100).toLocaleString('en-IN',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Describe exactly the positive rows staged for confirmation, without source identity fields. */
export function importValueAndDates(drafts) {
  const parsedTotal = drafts.reduce((paise, row) => paise + Math.round(row.value * 100), 0) / 100;
  const dates = drafts.map(row => row.asOf).filter(Boolean).sort();
  const dateNote = !dates.length ? 'No valuation dates were supplied.' :
    `${dates.length} of ${drafts.length} ${drafts.length === 1 ? 'row has a supplied valuation date' : 'rows have supplied valuation dates'}${dates[0] === dates.at(-1) ?
      ` (${dates[0]})` : ` (${dates[0]} to ${dates.at(-1)})`}.`;
  return `Parsed value ${rupees(parsedTotal)}. ${dateNote}`;
}

export { rupees };
