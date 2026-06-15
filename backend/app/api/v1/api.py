from fastapi import APIRouter
from app.api.v1.endpoints import auth, users, health, wallets, seed, stations, vehicles, restaurants, amenities, trips

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(wallets.router, prefix="/wallets", tags=["wallets"])
api_router.include_router(seed.router, prefix="/seed", tags=["seed"])
api_router.include_router(stations.router, prefix="/stations", tags=["stations"])
api_router.include_router(vehicles.router, prefix="/vehicles", tags=["vehicles"])
api_router.include_router(restaurants.router, prefix="/restaurants", tags=["restaurants"])
api_router.include_router(amenities.router, prefix="/amenities", tags=["amenities"])
api_router.include_router(trips.router, prefix="/trips", tags=["trips"])
