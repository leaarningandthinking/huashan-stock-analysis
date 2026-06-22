from app.prompts.loader import load_master_sections


def test_bundled_master_skill_loads_all_registered_masters() -> None:
    sections = load_master_sections()

    assert len(sections) == 16
    assert all(section.methodology for section in sections.values())
    assert all(section.checkpoints for section in sections.values())
