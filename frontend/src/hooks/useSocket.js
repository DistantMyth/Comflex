import { useContext } from 'react';
import { SocketContext } from '../context/SocketContext';

const defaultSocketValue = {
  socket: null,
  connected: false,
  sendMessage: async () => {},
  joinAnonGroup: async () => {},
  startTyping: () => {},
  stopTyping: () => {},
  markRead: async () => {},
  markDMRead: async () => {},
  onEvent: () => () => {},
};

export function useSocket() {
  const context = useContext(SocketContext);
  return context || defaultSocketValue;
}

export default useSocket;
