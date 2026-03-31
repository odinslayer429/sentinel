import asyncio
import json
import logging
import os
from redis import asyncio as aioredis
from .ws_manager import manager

logger = logging.getLogger(__name__)

class RedisSubscriber:
    def __init__(self):
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.channel = "sentinel:events"
        self.pubsub = None
        self.redis = None

    async def start(self):
        """Starts the Redis subscription loop."""
        try:
            self.redis = aioredis.from_url(self.redis_url, decode_responses=True)
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe(self.channel)
            logger.info(f"Subscribed to Redis channel: {self.channel}")
            
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        await manager.broadcast(data)
                        logger.info(f"Broadcasted Redis message: {message['data'][:100]}...")
                    except json.JSONDecodeError:
                        logger.error(f"Failed to decode Redis message: {message['data']}")
                    except Exception as e:
                        logger.error(f"Error during broadcast: {e}")
        except Exception as e:
            logger.error(f"Redis subscription error: {e}")
        finally:
            if self.pubsub:
                await self.pubsub.unsubscribe(self.channel)
                await self.pubsub.close()
            if self.redis:
                await self.redis.close()

redis_subscriber = RedisSubscriber()

