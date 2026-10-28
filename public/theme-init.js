// Apply stored theme/language before first paint to avoid a flash. (External file so the CSP can forbid inline scripts.)
(function () {
  try {
    var t = localStorage.getItem('taptrail.theme');
    var l = localStorage.getItem('taptrail.lang');
    var dark = t === 'dark' || t === null || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (l === 'ar') {
      document.documentElement.lang = 'ar';
      document.documentElement.dir = 'rtl';
    }
  } catch {
    /* storage blocked: defaults apply */
  }
})();