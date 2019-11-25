using Assets.Src.ObjectManagement;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TimeDialationControler : MonoBehaviour {
    public KeyCode AccelerateTimeKey = KeyCode.PageUp;
    public KeyCode DecelerateTimeKey = KeyCode.PageDown;
    public KeyCode TogglePause = KeyCode.Space;
    private readonly TimeDialationDevice _tdd = new TimeDialationDevice();
    public bool AutoSetTimeScale = true;

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyUp(TogglePause))
        {
            _tdd.TogglePause();
            AutoSetTimeScale = false;
            return;
        }
        if (Input.GetKeyUp(AccelerateTimeKey))
        {
            _tdd.AccelerateTime();
            AutoSetTimeScale = false;
            return;
        }
        if (Input.GetKeyUp(DecelerateTimeKey))
        {
            _tdd.DecelerateTime();
            AutoSetTimeScale = false;
            return;
        }
        if (AutoSetTimeScale)
        {
            _tdd.AutoSetTimeScale();
        }
    }
}
