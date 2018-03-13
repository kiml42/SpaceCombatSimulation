using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using UnityEngine;

public class JointFriction : GeneticConfigurableMonobehaviour
{

    [Tooltip("mulitiplier for the angular velocity for the torque to apply.")]
    public float Friction = 0.4f;

    //[Tooltip("For debugging and testing")]
    //public Vector3 InitialKick;

    private HingeJoint _hinge;
    private Rigidbody _thisBody;
    private Rigidbody _connectedBody;
    private Vector3 _axis;  //local space

	// Use this for initialization
	void Start () {
        _hinge = GetComponent<HingeJoint>();
        _connectedBody = _hinge.connectedBody;
        _axis = _hinge.axis;

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
            var angularV = _hinge.velocity;
            //Debug.Log("angularV " + angularV);
            var worldAxis = transform.TransformVector(_axis);
            var worldTorque = Friction * angularV * worldAxis;

            _thisBody.AddTorque(-worldTorque);
            if(_connectedBody != null)
                _connectedBody.AddTorque(worldTorque);
        }
    }
    public bool GetConfigFromGenome = true;

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            Friction = genomeWrapper.GetScaledNumber(3);
        }

        return genomeWrapper;
    }
}
