import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAvailableRooms, type RoomListing } from '../api/room';

export function HomePage() {
  const [availableRooms, setAvailableRooms] = useState<RoomListing[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const rooms = await getAvailableRooms("market");
        setAvailableRooms(rooms);
      } catch (e) {
        console.error("Failed to fetch rooms:", e);
      }
    };
    fetchRooms();
  }, []);

  const handleJoin = (roomId: string) => {
    navigate(`/game/${roomId}`);
  };

  return (
    <div className="home-container" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Available Rooms</h1>
      {availableRooms.length === 0 ? (
        <div style={{ color: '#888', marginTop: '20px' }}>Loading rooms...</div>
      ) : (
        <div style={{ display: 'grid', gap: '20px', marginTop: '20px' }}>
          {availableRooms.map((r) => (
            <div key={r.roomId} style={{ 
              padding: '20px', 
              backgroundColor: '#1E1E1E', 
              borderRadius: '8px',
              border: '1px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h3 style={{ margin: '0 0 10px 0' }}>{r.metadata?.symbol || 'Unknown'} Market</h3>
                <div style={{ color: '#888' }}>
                  Players: {r.clients}/{r.maxClients}
                </div>
              </div>
              <button 
                onClick={() => handleJoin(r.roomId)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#2962FF',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Join Game
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
