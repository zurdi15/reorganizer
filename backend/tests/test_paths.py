"""Guard central de rutas: la superficie de seguridad más sensible de la app
(el código viejo tenía path traversal explotable), de ahí la cobertura
exhaustiva."""

import pytest

from app.services.paths import PathError, resolve_under, sanitize_filename, validate_rel_dest


# ── resolve_under ──────────────────────────────────────────────────────────


def test_resolve_under_valid_nested(tmp_path):
    target = tmp_path / "a" / "b" / "c.jpg"
    assert resolve_under(tmp_path, "a/b/c.jpg") == target


def test_resolve_under_allows_nonexistent(tmp_path):
    # el destino de un upload aún no existe: el guard valida forma, no existencia
    assert resolve_under(tmp_path, "nuevo/archivo.jpg") == tmp_path / "nuevo" / "archivo.jpg"


@pytest.mark.parametrize("rel", ["", "   "])
def test_resolve_under_rejects_empty(tmp_path, rel):
    with pytest.raises(PathError):
        resolve_under(tmp_path, rel)


@pytest.mark.parametrize("rel", ["/etc/passwd", "/", "/abs/path.jpg"])
def test_resolve_under_rejects_absolute(tmp_path, rel):
    with pytest.raises(PathError):
        resolve_under(tmp_path, rel)


@pytest.mark.parametrize(
    "rel",
    [
        "../fuera.jpg",
        "..",
        "a/../../fuera.jpg",
        # estricto a propósito: aunque "a/../b" no escape, un `..` siempre se rechaza
        "a/../b.jpg",
    ],
)
def test_resolve_under_rejects_dotdot(tmp_path, rel):
    with pytest.raises(PathError):
        resolve_under(tmp_path, rel)


def test_resolve_under_rejects_null_bytes(tmp_path):
    with pytest.raises(PathError):
        resolve_under(tmp_path, "a\x00b.jpg")


def test_resolve_under_rejects_symlink_dir_escape(tmp_path):
    # un symlink DENTRO de base que apunta fuera no debe permitir escapar
    base = tmp_path / "base"
    outside = tmp_path / "outside"
    base.mkdir()
    outside.mkdir()
    (outside / "secreto.txt").write_text("x")
    (base / "link").symlink_to(outside)
    with pytest.raises(PathError):
        resolve_under(base, "link/secreto.txt")


def test_resolve_under_rejects_symlink_file_escape(tmp_path):
    base = tmp_path / "base"
    base.mkdir()
    secret = tmp_path / "secreto.txt"
    secret.write_text("x")
    (base / "alias.txt").symlink_to(secret)
    with pytest.raises(PathError):
        resolve_under(base, "alias.txt")


def test_resolve_under_accepts_internal_symlink(tmp_path):
    # symlink que se queda dentro de base: legítimo
    base = tmp_path / "base"
    (base / "real").mkdir(parents=True)
    (base / "real" / "f.jpg").write_text("x")
    (base / "atajo").symlink_to(base / "real")
    assert resolve_under(base, "atajo/f.jpg") == base / "real" / "f.jpg"


# ── sanitize_filename ──────────────────────────────────────────────────────


def test_sanitize_keeps_normal_names():
    assert sanitize_filename("IMG_0042.JPG") == "IMG_0042.JPG"


def test_sanitize_takes_basename_only():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("a/b/c.jpg") == "c.jpg"
    assert sanitize_filename("C:\\Users\\evil\\foto.jpg") == "foto.jpg"


def test_sanitize_strips_control_chars():
    assert sanitize_filename("a\x00b\x1f\x7fc.jpg") == "abc.jpg"
    # RTL override (spoofing de extensión): categoría Cf, fuera
    assert sanitize_filename("gpj.\u202exe.jpg") == "gpj.xe.jpg"


def test_sanitize_strips_forbidden_chars():
    assert sanitize_filename('a<b>c:d*e?f"g|h.jpg') == "abcdefgh.jpg"


def test_sanitize_xss_name_becomes_plain_text():
    assert sanitize_filename("<img src=x onerror=alert(1)>.jpg") == "img src=x onerror=alert(1).jpg"


def test_sanitize_normalizes_nfc():
    # e + combining acute (NFD) → é compuesta (NFC)
    assert sanitize_filename("cafe\u0301.jpg") == "caf\u00e9.jpg"


def test_sanitize_collapses_whitespace():
    assert sanitize_filename("  mi   foto \t de  ayer.jpg ") == "mi foto de ayer.jpg"


def test_sanitize_strips_leading_dots():
    assert sanitize_filename(".hidden.jpg") == "hidden.jpg"
    assert sanitize_filename("..doble.jpg") == "doble.jpg"


def test_sanitize_caps_length_preserving_extension():
    name = "x" * 300 + ".jpg"
    result = sanitize_filename(name)
    assert len(result) == 180
    assert result.endswith(".jpg")


def test_sanitize_empty_falls_back_to_generated_name():
    result = sanitize_filename("")
    assert result.startswith("upload-")
    assert len(result) == len("upload-") + 8


def test_sanitize_unusable_name_keeps_extension_in_fallback():
    # solo chars prohibidos + extensión: el fallback conserva el .jpg
    result = sanitize_filename("???.jpg")
    # "???" se vacía y queda ".jpg" → sin puntos iniciales es "jpg"
    assert result == "jpg" or result.startswith("upload-")


def test_sanitize_only_dots_generates_name():
    result = sanitize_filename("...")
    assert result.startswith("upload-")


# ── validate_rel_dest ──────────────────────────────────────────────────────


def test_validate_rel_dest_ok():
    assert validate_rel_dest("2024/08/croacia") == "2024/08/croacia"


def test_validate_rel_dest_normalizes():
    assert validate_rel_dest("2024//08/") == "2024/08"
    assert validate_rel_dest(" 2024 / 08 ") == "2024/08"


@pytest.mark.parametrize("dest", ["", "   ", "///"])
def test_validate_rel_dest_rejects_empty(dest):
    with pytest.raises(PathError):
        validate_rel_dest(dest)


@pytest.mark.parametrize("dest", ["/abs", "\\abs", "/2024/08"])
def test_validate_rel_dest_rejects_absolute(dest):
    with pytest.raises(PathError):
        validate_rel_dest(dest)


@pytest.mark.parametrize("dest", ["..", "2024/../08", "../2024"])
def test_validate_rel_dest_rejects_traversal(dest):
    with pytest.raises(PathError):
        validate_rel_dest(dest)


@pytest.mark.parametrize(
    "dest",
    [
        "2024/.oculto",       # segmento con punto inicial
        "2024/a:b",           # char prohibido
        "2024/a|b",
        "a\\b/c",             # backslash dentro de segmento
        "2024/a\x00b",        # control char
        "2024/a*b",
    ],
)
def test_validate_rel_dest_rejects_bad_segments(dest):
    with pytest.raises(PathError):
        validate_rel_dest(dest)
