using UnityEngine;

public class JointBreakHandler : MonoBehaviour
{
    public bool DeactivateParent = false;
    public bool DeactivateOnBreak = true;
    public bool DisconectFromParent = true;
    public Rigidbody BreakExplosion;
    private bool _active = true;

    public void OnJointBreak(float breakForce)
    {
        Debug.Log(transform.name + "'s joint has just been broken!, force: " + breakForce);
        if (DisconectFromParent)
        {
            transform.parent = null;
        }
        if (BreakExplosion != null)
        {
            var boom = Instantiate(BreakExplosion, transform.position, transform.rotation);
            var rb = GetComponent<Rigidbody>();
            if (rb != null)
                boom.velocity = rb.velocity;
        }
        if (DeactivateOnBreak)
        {
            DeactivateJointObjects();
        }
    }

    private void DeactivateJointObjects()
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
