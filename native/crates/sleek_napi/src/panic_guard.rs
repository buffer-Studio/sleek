use std::panic::{catch_unwind, AssertUnwindSafe};

pub fn guard_panic<T, F>(context: &str, f: F) -> napi::Result<T>
where
  F: FnOnce() -> napi::Result<T>,
{
  match catch_unwind(AssertUnwindSafe(f)) {
    Ok(res) => res,
    Err(payload) => {
      let msg = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
      } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
      } else {
        "unknown panic payload".to_string()
      };
      Err(napi::Error::from_reason(format!("Rust panic in {context}: {msg}")))
    }
  }
}

