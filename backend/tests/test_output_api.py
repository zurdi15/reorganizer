from app.config import get_settings


def mkdirs(*rels):
    base = get_settings().output_dir
    for rel in rels:
        (base / rel).mkdir(parents=True, exist_ok=True)


def test_root_dirs_with_has_children(client):
    mkdirs("2024/08", "vacia", ".oculta")
    # los archivos sueltos no cuentan como hijos ni se listan
    (get_settings().output_dir / "suelto.txt").write_text("x")

    resp = client.get("/api/v1/output/dirs")
    assert resp.status_code == 200
    assert resp.json() == [
        {"name": "2024", "has_children": True},
        {"name": "vacia", "has_children": False},
    ]


def test_nested_path(client):
    mkdirs("2024/08", "2024/09")
    resp = client.get("/api/v1/output/dirs", params={"path": "2024"})
    assert resp.json() == [
        {"name": "08", "has_children": False},
        {"name": "09", "has_children": False},
    ]


def test_nonexistent_path_is_empty_list(client):
    # autocompletado de una carpeta aún no creada: caso normal, no un 404
    assert client.get("/api/v1/output/dirs", params={"path": "nueva/carpeta"}).json() == []


def test_traversal_rejected(client):
    for path in ("../..", "../../etc", "/etc", ".."):
        resp = client.get("/api/v1/output/dirs", params={"path": path})
        assert resp.status_code == 400, path
        assert resp.json()["detail"] == "invalid_path"


def test_symlink_escape_rejected(client):
    base = get_settings().output_dir
    outside = base.parent / "fuera-output"
    outside.mkdir(exist_ok=True)
    (base / "link").symlink_to(outside)
    resp = client.get("/api/v1/output/dirs", params={"path": "link"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_path"
