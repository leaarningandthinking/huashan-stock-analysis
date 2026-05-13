import pytest

from app.core.sse import EventQueue


@pytest.mark.asyncio
async def test_event_queue_assigns_ordered_ids_and_persists_before_streaming():
    persisted = []
    queue = EventQueue(on_emit=lambda ev: _append(persisted, ev))

    await queue.emit("step.start", step=1)
    await queue.emit("step.done", step=1)
    await queue.close()

    assert [ev.id for ev in persisted] == ["1", "2"]
    assert [ev.event for ev in persisted] == ["step.start", "step.done"]

    streamed = []
    async for ev in queue.stream():
        streamed.append(ev)

    assert [ev.id for ev in streamed] == ["1", "2"]
    assert [ev.data for ev in streamed] == [{"step": 1}, {"step": 1}]


async def _append(items, ev):
    items.append(ev)
