using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using UnityEngine;

public class GenericJointFriction : MonoBehaviour, IGeneticConfigurable
{

    [Tooltip("mulitiplier for the angular velocity for the torque to apply.")]
    public float Friction = 0.4f;

    //[Tooltip("For debugging and testing")]
    //public Vector3 InitialKick;

    public Joint _hinge;
    public Rigidbody _thisBody;
    public Rigidbody _connectedBody;

	// Use this for initialization
	void Start () {
        _hinge = GetComponent<Joint>();
        _connectedBody = _hinge.connectedBody;

        _thisBody = GetComponent<Rigidbody>();

        //if(InitialKick.magnitude > 0 )
        //{
        //    _thisBody.AddRelativeTorque(InitialKick, ForceMode.VelocityChange);
        //}
    }
	
	// Update is called once per frame
	void FixedUpdate () {
        if(_hinge != null)
        {
            var parentAngularV = _connectedBody.angularVelocity;
            var ownAngularV = _thisBody.angularVelocity;
            
            //Debug.Log("angularV " + angularV);
            var worldTorque = Friction * (ownAngularV - parentAngularV);

            _thisBody.AddTorque(-worldTorque);
            _connectedBody.AddTorque(worldTorque);
        }
    }

    public bool GetConfigFromGenome = true;

    public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            Friction = genomeWrapper.GetScaledNumber(3);
        }

        return genomeWrapper;
    }
}
