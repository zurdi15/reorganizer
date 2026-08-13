from app.services.broadcaster import Broadcaster


class FakeWS:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        if self.fail:
            raise RuntimeError("socket cerrado")
        self.sent.append(data)


async def test_broadcast_reaches_all_clients():
    hub = Broadcaster()
    a, b = FakeWS(), FakeWS()
    hub.add(a)
    hub.add(b)
    event = {"type": "job-status", "data": {"job_id": 1, "status": "running"}}
    await hub.broadcast(event)
    assert a.sent == [event]
    assert b.sent == [event]


async def test_broadcast_sweeps_dead_clients():
    hub = Broadcaster()
    alive, dead = FakeWS(), FakeWS(fail=True)
    hub.add(alive)
    hub.add(dead)
    await hub.broadcast({"type": "x", "data": {}})
    assert dead not in hub.clients
    assert alive in hub.clients
    # el barrido no impide que los vivos reciban
    assert len(alive.sent) == 1


async def test_replay_ring_caps_at_300():
    hub = Broadcaster()
    for i in range(305):
        await hub.broadcast({"type": "n", "data": {"i": i}})
    payload = hub.state_sync_payload()
    events = payload["data"]["events"]
    assert len(events) == 300
    assert events[0]["data"]["i"] == 5  # los 5 más viejos se cayeron
    assert events[-1]["data"]["i"] == 304


def test_state_sync_payload_shape():
    hub = Broadcaster()
    payload = hub.state_sync_payload(job={"id": 7, "status": "running"})
    assert payload == {
        "type": "state-sync",
        "data": {"job": {"id": 7, "status": "running"}, "events": []},
    }
    assert hub.state_sync_payload()["data"]["job"] is None
