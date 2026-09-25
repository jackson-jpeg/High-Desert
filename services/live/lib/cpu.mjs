/**
 * The process's own CPU, as a percentage of one core, averaged over the last
 * 15 minutes. Read from process.cpuUsage() — the kernel's accounting for this
 * process, not an estimate — sampled once a minute, so it costs nothing.
 *
 * The 10% rule (no High Desert background service may sustain more than 10%
 * of a core) is judged by highdesert-status on hd-cpu-sample's cgroup ring;
 * this is the fallback it reads from /live-api/health while that ring is
 * too young to cover 15 minutes, and a second witness for anyone debugging.
 */

export function createCpuSampler({ everyMs = 60_000, windowMs = 15 * 60_000, cpu = () => process.cpuUsage(), clock = () => performance.now() } = {}) {
  const samples = [];
  const take = () => {
    const u = cpu();
    samples.push({ t: clock(), us: u.user + u.system });
    const keep = Math.ceil(windowMs / everyMs) + 1;
    while (samples.length > keep) samples.shift();
  };
  take();
  const timer = setInterval(take, everyMs);
  timer.unref?.();

  return {
    take,
    /** { pct, windowS } over the oldest retained sample to now; null until a minute has passed. */
    average() {
      const first = samples[0];
      const u = cpu();
      const t = clock();
      const wallMs = t - first.t;
      if (wallMs < Math.min(everyMs, windowMs) * 0.9) return null;
      const pct = ((u.user + u.system - first.us) / 1000 / wallMs) * 100;
      return { pct: Math.round(pct * 100) / 100, windowS: Math.round(wallMs / 1000) };
    },
    stop() {
      clearInterval(timer);
    },
  };
}
