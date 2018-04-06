using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TimeDialationControler : MonoBehaviour {
    public KeyCode AccelerateTimeKey = KeyCode.PageUp;
    public KeyCode DecelerateTimeKey = KeyCode.PageDown;
    public float SmallIncrement = 0.1f;

    // Use this for initialization
    void Start () {
		
	}

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyUp(AccelerateTimeKey))
        {
            AccelerateTime();
        }
        if (Input.GetKeyUp(DecelerateTimeKey))
        {
            DecelerateTime();
        }
        Debug.Log("TimeScale set to " + Time.timeScale);
    }

    private void AccelerateTime()
    {
        if(Time.timeScale < 1)
        {
            Time.timeScale += SmallIncrement;
            return;
        }
        Time.timeScale++;
    }

    private void DecelerateTime()
    {
        if (Time.timeScale <= 1)
        {
            Time.timeScale = Math.Max(0, Time.timeScale - SmallIncrement);
            return;
        }
        Time.timeScale--;
    }
}
