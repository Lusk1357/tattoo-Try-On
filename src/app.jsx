import React, { useState } from 'react';
import SmartEditor from './components/SmartEditor';

function App() {
  const [selectedImage, setSelectedImage] = useState(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSelectedImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  if (selectedImage) {
    return <SmartEditor imageSrc={selectedImage} />;
  }

  return (
    <div style={{ 
      height: '100vh', background: '#000', color: '#fff', 
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' 
    }}>
      <h1 style={{ fontFamily: 'sans-serif' }}></h1>
      <p style={{ color: '#888' }}>Upload de foto para detecção anatômica</p>
      
      <label style={{
        marginTop: '20px', padding: '15px 40px', background: '#00ff00', color: '#000',
        fontWeight: 'bold', borderRadius: '30px', cursor: 'pointer', fontSize: '18px'
      }}>
        CARREGAR FOTO
        <input type="file" accept="image/*" hidden onChange={handleImageUpload} />
      </label>
    </div>
  );
}

export default App;