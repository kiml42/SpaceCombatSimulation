using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    class TimeDialationDevice
    {
        public float LargeIncrement = 0.5f;
        public float SmallIncrement = 0.1f;

        private List<float> _deltas = new List<float>();
        public float AutoTimeScaleTime = 5;
        public float AccelerateThreshod = 0.02f;
        public float DecelerateThreshod = 0.1f;

        public float TimeScaleCap = 8;
        public float TimeScaleFloor = 0.1f;

        public void AutoSetTimeScale()
        {
            _deltas.Add(Time.unscaledDeltaTime);
            if(_deltas.Sum() > AutoTimeScaleTime)
            {
                var averageDelta = _deltas.Average();
                if(averageDelta < AccelerateThreshod) { AccelerateTime(); }
                if(averageDelta > DecelerateThreshod) { DecelerateTime(); }
                _deltas = new List<float>();
            }
        }

        public void AccelerateTime()
        {
            var currentTimeScale = Time.timeScale;
            if (currentTimeScale < 1)
            {
                currentTimeScale += SmallIncrement;
            }
            else
            {
                currentTimeScale += LargeIncrement;
            }
            Time.timeScale = GetTimescaleInRange(currentTimeScale);
            Debug.Log("TimeScale accelerated to " + currentTimeScale);
        }

        private float GetTimescaleInRange(float desiredTimeScale)
        {
            desiredTimeScale = Math.Max(TimeScaleFloor, desiredTimeScale);
            desiredTimeScale = Math.Min(TimeScaleCap, desiredTimeScale);
            return desiredTimeScale;
        }

        public void DecelerateTime()
        {
            var currentTimeScale = Time.timeScale;
            if (currentTimeScale <= 1)
            {
                currentTimeScale = Math.Max(0, currentTimeScale - SmallIncrement);
                return;
            } else
            {
                currentTimeScale -= LargeIncrement;
            }
            Time.timeScale = GetTimescaleInRange(currentTimeScale);
            Debug.Log("TimeScale decelerated to " + currentTimeScale);
        }
    }
}
