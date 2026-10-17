/* 帧时间以秒输入，预算以毫秒判断；后台时间不进入动画相位。 */
export class FrameBudget {
  constructor() {
    this.acc = 0;
    this.n = 0;
    this.throttled = false;
  }

  observe(seconds) {
    if (this.throttled || !Number.isFinite(seconds) || seconds < 0) return false;
    this.acc += seconds * 1000;
    this.n++;
    if (this.n < 90) return false;
    const slow = this.acc / this.n > 27;
    this.resetWindow();
    if (slow) this.throttled = true;
    return slow;
  }

  resetWindow() {
    this.acc = 0;
    this.n = 0;
  }
}

export function discardClockDelta(clock) {
  const elapsed = clock.elapsedTime;
  clock.getDelta();
  clock.elapsedTime = elapsed;
}
