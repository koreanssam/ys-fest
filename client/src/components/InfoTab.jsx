import React from 'react';

function InfoTab() {
  return (
    <div className="container" style={{paddingTop:0}}>
      <div className="card">
        <h2>🎉 2025 영축한마당</h2>
        <p>2025학년도 영산중학교 축제에 오신 것을 환영합니다!</p>
        
        <h3>📍 일시 및 장소</h3>
        <p>
           🗓 2025년 12월 30일 (화)<br/>
           🏫 본교 강당 및 교실
        </p>
        
        <h3>📜 축제 목적</h3>
        <p>
            학생들과 교직원 모두가 화합하고 단결하는 한마당 축제의 장!<br/>
            협동성, 창의성을 기르고 끼를 마음껏 발산하는 시간입니다.
        </p>
      </div>

      <div className="card">
        <h3>📅 일정 안내 (12.30)</h3>
        <ul style={{paddingLeft: '20px', lineHeight: '1.6'}}>
            <li><b>08:30 ~ 09:30</b> 부스 준비</li>
            <li><b>09:30 ~ 11:00</b> 1부: 부스 마당 (각 반 교실)</li>
            <li><b>11:00 ~ 12:00</b> 부스 정리</li>
            <li><b>12:00 ~ 13:00</b> 점심 식사</li>
            <li><b>13:10 ~ 15:10</b> 2부: 공연 마당 (체육관)</li>
            <li><b>15:10 ~ 15:20</b> 시상식</li>
            <li><b>15:20 ~ 15:55</b> 청소 및 종례</li>
        </ul>
      </div>
    </div>
  );
}

export default InfoTab;
