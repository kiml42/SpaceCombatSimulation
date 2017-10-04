﻿using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class JointBreakHandler : MonoBehaviour {
    public bool DeactivateParent = false;
    public bool DeactivateOnBreak = true;
    public bool DisconectFromParent = true;
    public Rigidbody BreakExplosion;
    private bool _active = true;

    void OnJointBreak(float breakForce)
    {
        //Debug.Log(transform.name + "'s joint has just been broken!, force: " + breakForce);
        if (DisconectFromParent)
        {
            transform.parent = null;
        }
        if (BreakExplosion != null)
        {
            var boom = Instantiate(BreakExplosion);
            var rb = GetComponent("Rigidbody") as Rigidbody;
            if (rb != null)
                boom.velocity = rb.velocity;
        }
        if (DeactivateOnBreak)
        {
            Deactivate();
        }
    }

    public void Deactivate()
    {
        if (_active)
        {
            _active = false;
            transform.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
        }
        if (DeactivateParent && transform.parent != null)
        {
            transform.parent.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
        }
    }
}
