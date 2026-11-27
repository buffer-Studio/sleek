use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Sliding-window outbound gateway ratelimiter (120 events per 60s, reserving headroom for heartbeats).
pub struct GatewayRatelimiter {
  capacity: usize,
  window: Duration,
  timestamps: VecDeque<Instant>,
}

impl GatewayRatelimiter {
  pub fn new(capacity: usize, window: Duration) -> Self {
    Self {
      capacity,
      window,
      timestamps: VecDeque::with_capacity(capacity),
    }
  }

  pub fn default_discord() -> Self {
    // Reserve 10 slots for heartbeats out of Discord's 120/60s limit.
    Self::new(110, Duration::from_secs(60))
  }

  pub fn try_acquire(&mut self, now: Instant) -> bool {
    while let Some(&front) = self.timestamps.front() {
      if now.duration_since(front) >= self.window {
        self.timestamps.pop_front();
      } else {
        break;
      }
    }

    if self.timestamps.len() >= self.capacity {
      return false;
    }

    self.timestamps.push_back(now);
    true
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn enforces_sliding_window_capacity() {
    let mut limiter = GatewayRatelimiter::new(2, Duration::from_secs(60));
    let t0 = Instant::now();
    assert!(limiter.try_acquire(t0));
    assert!(limiter.try_acquire(t0 + Duration::from_secs(1)));
    assert!(!limiter.try_acquire(t0 + Duration::from_secs(2)));
    assert!(limiter.try_acquire(t0 + Duration::from_secs(61)));
  }
}
