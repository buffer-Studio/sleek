use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{sleep, Instant};

#[derive(Clone)]
pub struct LocalIdentifyQueue {
  inner: Arc<Mutex<Instant>>,
  interval: Duration,
}

impl LocalIdentifyQueue {
  pub fn new(interval: Duration) -> Self {
    Self {
      inner: Arc::new(Mutex::new(Instant::now() - interval)),
      interval,
    }
  }

  pub async fn request(&self) {
    let mut last = self.inner.lock().await;
    let elapsed = last.elapsed();
    if elapsed < self.interval {
      sleep(self.interval - elapsed).await;
    }
    *last = Instant::now();
  }
}

type RequestCallback = Arc<dyn Fn(String, u32) + Send + Sync>;

#[derive(Clone)]
pub struct IdentifyGate {
  local: LocalIdentifyQueue,
  on_request: Option<RequestCallback>,
  pending: Arc<Mutex<HashMap<(String, u32), oneshot::Sender<()>>>>,
}

impl IdentifyGate {
  pub fn new(interval: Duration, on_request: Option<RequestCallback>) -> Self {
    Self {
      local: LocalIdentifyQueue::new(interval),
      on_request,
      pending: Arc::new(Mutex::new(HashMap::new())),
    }
  }

  pub async fn request(&self, platform: &str, shard_id: u32) {
    if let Some(cb) = &self.on_request {
      let (tx, rx) = oneshot::channel();
      {
        let mut map = self.pending.lock().await;
        map.insert((platform.to_string(), shard_id), tx);
      }
      cb(platform.to_string(), shard_id);
      let _ = rx.await;
    } else {
      self.local.request().await;
    }
  }

  pub async fn grant(&self, platform: &str, shard_id: u32) {
    let tx = {
      let mut map = self.pending.lock().await;
      map.remove(&(platform.to_string(), shard_id))
    };
    if let Some(sender) = tx {
      let _ = sender.send(());
    }
  }
}
