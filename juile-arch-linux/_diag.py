import asyncio
from server import tools

async def main():
    print("=== pyautogui ===")
    print(await tools.computer({"action": "position"}))
    print(await tools.computer({"action": "move", "x": 300, "y": 300}))
    print(await tools.computer({"action": "position"}))

    print("\n=== Composio MCP list ===")
    print((await tools.mcp({"server": "composio", "op": "list"}))[:1500])

    print("\n=== Zapier MCP list ===")
    print((await tools.mcp({"server": "zapier", "op": "list"}))[:800])

asyncio.run(main())
