'use client';

import React from 'react';
import VideoChat from '../components/VideoChat.js';

export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">Group Chat</h1>
      <VideoChat />
    </main>
  );
}
