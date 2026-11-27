pub mod core;
pub mod discord;
pub mod fluxer;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinSet;

pub use crate::core::batch_pump::{GatewayBatch, GatewayBatchEvent};
use crate::core::batch_pump::{create_batch_channel, run_batch_pump};
use crate::core::event_flags::DEFAULT_INTEREST;
use crate::core::identify_queue::IdentifyGate;
use crate::discord::twilight_cluster::run_discord_shard;
use crate::fluxer::fluxer_cluster::run_fluxer_shard;

pub struct GatewayConfig {
  pub discord_token: Option<String>,
  pub discord_intents: u64,
  pub discord_shard_start: u32,
  pub discord_shard_end: u32,
  pub discord_total_shards: u32,
  pub fluxer_token: Option<String>,
  pub fluxer_ws_url: String,
  pub fluxer_shard_start: u32,
  pub fluxer_shard_end: u32,
  pub fluxer_total_shards: u32,
  pub interest_mask: Option<u64>,
}

pub struct GatewaySupervisor {
  interest: Arc<AtomicU64>,
  identify_gate: IdentifyGate,
  shutdown_tx: watch::Sender<bool>,
  tasks: JoinSet<()>,
}

impl GatewaySupervisor {
  pub fn start<F, G>(config: GatewayConfig, on_batch: F, on_identify_request: Option<G>) -> Self
  where
    F: FnMut(GatewayBatch) + Send + 'static,
    G: Fn(String, u32) + Send + Sync + 'static,
  {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let interest = Arc::new(AtomicU64::new(config.interest_mask.unwrap_or(DEFAULT_INTEREST)));
    let identify_cb: Option<Arc<dyn Fn(String, u32) + Send + Sync>> =
      on_identify_request.map(|cb| Arc::new(cb) as Arc<dyn Fn(String, u32) + Send + Sync>);
    let identify_gate = IdentifyGate::new(Duration::from_secs(5), identify_cb);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let (sender, rx) = create_batch_channel();
    let mut tasks = JoinSet::new();

    let pump_sender = sender.clone();
    tasks.spawn(async move {
      run_batch_pump(rx, pump_sender, on_batch).await;
    });

    if let Some(token) = config.discord_token {
      let total = config.discord_total_shards.max(1);
      let start = config.discord_shard_start.min(total - 1);
      let end = config.discord_shard_end.min(total - 1);
      for shard_id in start..=end {
        let tok = token.clone();
        let shard_interest = Arc::clone(&interest);
        let shard_gate = identify_gate.clone();
        let shard_sender = sender.clone();
        let shard_rx = shutdown_rx.clone();
        tasks.spawn(async move {
          run_discord_shard(
            tok,
            shard_id,
            total,
            config.discord_intents,
            shard_interest,
            shard_gate,
            shard_sender,
            shard_rx,
          )
          .await;
        });
      }
    }

    if let Some(token) = config.fluxer_token {
      let total = config.fluxer_total_shards.max(1);
      let start = config.fluxer_shard_start.min(total - 1);
      let end = config.fluxer_shard_end.min(total - 1);
      for shard_id in start..=end {
        let tok = token.clone();
        let ws_url = config.fluxer_ws_url.clone();
        let shard_interest = Arc::clone(&interest);
        let shard_gate = identify_gate.clone();
        let shard_sender = sender.clone();
        let shard_rx = shutdown_rx.clone();
        tasks.spawn(async move {
          run_fluxer_shard(
            tok,
            ws_url,
            shard_id,
            total,
            shard_interest,
            shard_gate,
            shard_sender,
            shard_rx,
          )
          .await;
        });
      }
    }

    Self {
      interest,
      identify_gate,
      shutdown_tx,
      tasks,
    }
  }

  pub fn set_event_interest(&self, mask: u64) {
    self.interest.store(mask, Ordering::Relaxed);
  }

  pub async fn grant_identify(&self, platform: &str, shard_id: u32) {
    self.identify_gate.grant(platform, shard_id).await;
  }

  pub async fn stop(mut self, timeout_ms: u64) {
    let _ = self.shutdown_tx.send(true);
    let drain = async {
      while self.tasks.join_next().await.is_some() {}
    };
    if tokio::time::timeout(Duration::from_millis(timeout_ms), drain)
      .await
      .is_err()
    {
      self.tasks.abort_all();
    }
  }
}
