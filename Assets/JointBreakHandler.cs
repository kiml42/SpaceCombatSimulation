using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class JointBreakHandler : MonoBehaviour {
    public bool DeactivateParent = false;
    public bool DeactivateOnBreak = true;

    void OnJointBreak(float breakForce)
    {
        Debug.Log("A joint has just been broken!, force: " + breakForce);
        if (DeactivateOnBreak)
        {
            Deactivate();
        }
    }

    public void Deactivate()
    {
        transform.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
        if (DeactivateParent && transform.parent != null)
        {
            transform.parent.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
        }
    }
}
