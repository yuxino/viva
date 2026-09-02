use std::{env, fs, process::ExitCode};
use viva_updater_verifier::verify_updater_signature;

fn run() -> Result<(), String> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let [public_key, signature_path, artifact_path] = arguments.as_slice() else {
        return Err(
            "usage: viva-updater-verifier <public-key> <signature-file> <artifact-file>".into(),
        );
    };
    let signature = fs::read_to_string(signature_path)
        .map_err(|error| format!("could not read signature file: {error}"))?;
    let artifact = fs::read(artifact_path)
        .map_err(|error| format!("could not read updater artifact: {error}"))?;
    verify_updater_signature(&artifact, &signature, public_key)
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
