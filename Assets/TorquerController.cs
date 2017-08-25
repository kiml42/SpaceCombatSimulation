using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TorquerController : MonoBehaviour, IDeactivatable
{
    private bool _active;
    private string InactiveTag = "Untagged";

    // Use this for initialization
    void Start()
    {
        Transform parent = transform.FindOldestParent();

        if (parent != transform)
        {
            NotifyParent(parent);
        }
    }

    private void NotifyParent(Transform parent)
    {
        parent.SendMessage("RegisterTorquer", transform, SendMessageOptions.DontRequireReceiver);
    }

    public void Deactivate()
    {
        _active = false;
        tag = InactiveTag;
    }
}
