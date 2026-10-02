if (location.protocol === 'http:' &&
    ['thefinxperts.com', 'www.thefinxperts.com'].includes(location.hostname.toLowerCase())) {
  document.documentElement.classList.add('awaiting-https');
}
