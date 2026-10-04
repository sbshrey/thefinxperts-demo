/** A dated public-data card needs another source review when its review date arrives. */
export function contextNeedsReview(nextReviewDate, indiaDate) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return !validDate(nextReviewDate) || !validDate(indiaDate) || indiaDate >= nextReviewDate;
}

const INDIA_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function indiaToday(now = Date.now()) {
  return new Date(now + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Refresh dated public facts at India midnight and after a sleeping tab resumes. */
export function observeIndiaDateChange(onDate) {
  let lastDate = '';
  let timer;
  const refresh = () => {
    const now = Date.now();
    const date = indiaToday(now);
    if (date !== lastDate) {
      lastDate = date;
      onDate(date);
    }
    clearTimeout(timer);
    timer = setTimeout(refresh, DAY_MS - ((now + INDIA_OFFSET_MS) % DAY_MS) + 50);
  };
  const onVisible = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', refresh);
  refresh();
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', refresh);
  };
}

/** Keep a dated public fact out of the guided review once its next release is due. */
export function inflationContext(indiaDate) {
  const links = [
    ['Original MoSPI release', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2310058&lang=1&reg=19'],
    ['Latest MoSPI CPI tables', 'https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI'],
  ];
  if (contextNeedsReview('2026-10-12', indiaDate)) return {
    title: 'Inflation context needs a source check',
    source: 'The August 2026 CPI reading may have been superseded.',
    detail: 'Open the latest MoSPI tables before revisiting the inflation assumption you chose for a goal.',
    status: 'Source review due since 12 October 2026.', links,
  };
  return {
    title: 'Inflation context for your goal',
    source: 'MoSPI reported provisional all-India CPI inflation of 4.82% year on year for August 2026 (2024 base), released 14 September.',
    detail: 'Your chosen inflation assumption changes the future cost illustration. One national monthly reading is not a forecast for your goal.',
    status: 'Source checked 3 October 2026 · next review due 12 October.', links,
  };
}
