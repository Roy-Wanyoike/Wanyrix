//! Fixture crate: middle crate depending on the leaf.
pub fn two() -> u32 {
    tiny_fixture_alpha::one() + 1
}
