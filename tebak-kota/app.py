from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = 'kunci_rahasia_tebak_kota'
socketio = SocketIO(app)
SERVER_BOOT_ID = str(uuid.uuid4())

# In-memory storage sementara untuk prototype
rooms = {}

def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))

@app.route('/')
def index():
    return render_template('index.html', server_boot_id=SERVER_BOOT_ID)

@app.route('/create_room', methods=['POST'])
def create_room():
    data = request.json
    room_code = generate_room_code()
    
    rooms[room_code] = {
        "host_name": data.get('nickname', 'Host'),
        "max_players": int(data.get('max_players', 10)),
        "win_points": int(data.get('win_points', 100)),
        "players": {},
        "status": "waiting"
    }
    return jsonify({"success": True, "room_code": room_code})

@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    available_rooms = []
    for code, room in rooms.items():
        if room['status'] == 'waiting':
            available_rooms.append({
                "code": code,
                "host_name": room['host_name'],
                "players_count": len(room['players']),
                "max_players": room['max_players'],
                "win_points": room['win_points']
            })
    return jsonify(available_rooms)

@app.route('/room/<room_code>')
def room(room_code):
    room_code = room_code.upper()
    # Pengecekan eksistensi Room kini dihandle oleh Node.js Socket
    return render_template('room.html', room_code=room_code, server_boot_id=SERVER_BOOT_ID)

@socketio.on('join')
def on_join(data):
    room_code = data.get('room_code')
    nickname = data.get('nickname')
    avatar = data.get('avatar')
    is_host = data.get('is_host', False)
    
    if room_code not in rooms:
        emit('error', {'message': 'Room not found'})
        return
        
    room = rooms[room_code]
    
    if room['status'] != 'waiting' and not is_host:
        emit('error', {'message': 'Game already started'})
        return
        
    if len(room['players']) >= room['max_players'] and not is_host:
        emit('error', {'message': 'Room is full'})
        return
        
    join_room(room_code)
    
    room['players'][request.sid] = {
        "nickname": nickname,
        "avatar": avatar,
        "score": 0,
        "is_host": is_host,
        "sid": request.sid
    }
    
    emit('room_update', {
        "players": list(room['players'].values()), 
        "status": room['status'],
        "max_players": room['max_players'],
        "win_points": room['win_points']
    }, to=room_code)

@socketio.on('start_game')
def on_start_game(data):
    room_code = data.get('room_code')
    if room_code in rooms:
        rooms[room_code]['status'] = 'playing'
        emit('game_starting', {}, to=room_code)

@socketio.on('disconnect')
def on_disconnect():
    for room_code, room in rooms.items():
        if request.sid in room['players']:
            del room['players'][request.sid]
            emit('room_update', {
                "players": list(room['players'].values()), 
                "status": room['status'],
                "max_players": room['max_players'],
                "win_points": room['win_points']
            }, to=room_code)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
