const Logger = (() => {
  const LEVELS = { info: 'INFO', success: 'SUCCESS', warning: 'WARN', error: 'ERROR', download: 'DOWNLOAD' };
  const listeners = [];

  function log(level, message) {
    const entry = { level, message, timestamp: new Date().toISOString() };
    console.log(`[InstaGestor][${LEVELS[level] || level}] ${message}`);
    listeners.forEach(fn => fn(entry));
  }

  return {
    info: msg => log('info', msg),
    success: msg => log('success', msg),
    warning: msg => log('warning', msg),
    error: msg => log('error', msg),
    download: msg => log('download', msg),
    onLog: fn => listeners.push(fn),
  };
})();
