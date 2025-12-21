import React, { useState } from 'react';

// StarSlider: Range Input (0-10) styled as Stars
export default function StarSlider({ label, maxScore, value, onChange }) {
  // value is the raw score (e.g. 25).
  // We need to convert it to 0-10 stars.
  // starValue (0-10) = (value / maxScore) * 10
  const starValue = Math.round((value / maxScore) * 10);

  const handleStarClick = (idx) => {
      // idx is 1-10
      const newScore = (idx / 10) * maxScore;
      onChange(newScore);
  };

  return (
    <div style={{ marginBottom: '16px' }}>
        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
            <label style={{fontWeight:'bold'}}>{label}</label>
            <span>{value} / {maxScore}</span>
        </div>
        
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
            {[1,2,3,4,5,6,7,8,9,10].map(i => (
                <span 
                    key={i} 
                    onClick={() => handleStarClick(i)}
                    style={{
                        fontSize: '1.5rem', 
                        cursor: 'pointer',
                        color: i <= starValue ? '#FFD700' : '#444',
                        transition: 'color 0.2s'
                    }}
                >
                    ★
                </span>
            ))}
        </div>
    </div>
  );
}
