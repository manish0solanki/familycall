import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { CallsProvider } from './lib/calls';
import { AddContact } from './pages/AddContact';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Room } from './pages/Room';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CallsProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/add/:username" element={<AddContact />} />
            <Route path="/room/:roomId" element={<Room />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CallsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
