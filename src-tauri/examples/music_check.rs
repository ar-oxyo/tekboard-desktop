//! What the music source of TekSpace really reads on this computer:
//!   cargo run --example music_check            (MPRIS: the desktop player)
//!   cargo run --example music_check -- spotify (the Spotify account, once linked in the app)

fn main() {
    let spotify = std::env::args().nth(1).as_deref() == Some("spotify");
    let r = if spotify { tekboard_lib::music::spotify_now() } else { tekboard_lib::music::mpris_now() };
    match r {
        Ok(Some(np)) => println!("{} — {} [{}] {} · cover: {}", np.title, np.artist, np.player, if np.playing { "lecture" } else { "pause" }, np.art.map(|a| format!("{} octets", a.len())).unwrap_or_else(|| "aucune".into())),
        Ok(None) => println!("rien en lecture"),
        Err(e) => println!("erreur : {e}"),
    }
}
