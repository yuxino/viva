use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};

pub fn verify_updater_signature(
    data: &[u8],
    release_signature: &str,
    public_key: &str,
) -> Result<(), String> {
    let decoded_public_key = STANDARD
        .decode(public_key.trim())
        .map_err(|error| format!("invalid updater public key: {error}"))?;
    let decoded_public_key = std::str::from_utf8(&decoded_public_key)
        .map_err(|error| format!("updater public key is not UTF-8: {error}"))?;
    let public_key = PublicKey::decode(decoded_public_key)
        .map_err(|error| format!("invalid updater public key: {error}"))?;

    let decoded_signature = STANDARD
        .decode(release_signature.trim())
        .map_err(|error| format!("invalid updater signature: {error}"))?;
    let decoded_signature = std::str::from_utf8(&decoded_signature)
        .map_err(|error| format!("updater signature is not UTF-8: {error}"))?;
    let signature = Signature::decode(decoded_signature)
        .map_err(|error| format!("invalid updater signature: {error}"))?;

    public_key
        .verify(data, &signature, true)
        .map_err(|error| format!("updater signature verification failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::verify_updater_signature;

    const PUBLIC_KEY: &str = include_str!("../tests/fixtures/public-key.txt");
    const SIGNATURE: &str = include_str!("../tests/fixtures/payload.txt.sig");

    #[test]
    fn accepts_the_controlled_signed_fixture() {
        verify_updater_signature(b"viva updater fixture\n", SIGNATURE, PUBLIC_KEY).unwrap();
    }

    #[test]
    fn rejects_a_changed_payload() {
        let error =
            verify_updater_signature(b"viva updater fixture changed\n", SIGNATURE, PUBLIC_KEY)
                .unwrap_err();
        assert!(error.contains("verification failed"));
    }
}
