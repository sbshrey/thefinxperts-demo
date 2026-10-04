/** A private, self-chosen nickname, never a broker account number or PAN. */
export function validBrokerAccountLabel(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z -]{0,39}$/.test(value.trim()) &&
    value.trim().length >= 2;
}

export function brokerAccountKey(value) {
  return validBrokerAccountLabel(value) ?
    value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ') : null;
}

export function sameBrokerAccount(first, second) {
  return brokerAccountKey(first) !== null && brokerAccountKey(first) === brokerAccountKey(second);
}
