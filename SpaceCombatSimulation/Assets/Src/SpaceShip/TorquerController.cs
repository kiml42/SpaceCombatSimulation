using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using UnityEngine;

public class TorquerController : AbstractDeactivatableController, ITorquer
{
    public float MaxTorque = 1000;
    public bool Log;
    private float initialAngularDrag;

    private Rigidbody _rigidbody;
    private Vector3? _torque;

    // Use this for initialization
    void Start()
    {
        _rigidbody = GetComponent<Rigidbody>();
        if(_rigidbody == null)
        {
            Debug.LogError($"{this} hasn't got a rigidbody to apply torque to.");
        }
        initialAngularDrag = _rigidbody.angularDrag;
    }

    void FixedUpdate()
    {
        if(_torque.HasValue)
        {
            if (Log)
                Debug.Log($"{this} Torquing at {_torque}");
            _rigidbody.AddTorque(_torque.Value);
        }
    }

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        MaxTorque = genomeWrapper.GetProportionalNumber() * MaxTorque;
        this.HasBeenConfiguredByGenome = true;
        return genomeWrapper;
    }

    public void SetTorque(Vector3? torque)
    {
        //TODO don't always go at max torque.
        this._torque = torque?.normalized * MaxTorque;
    }

    public void Activate()
    {
        if (_rigidbody == null) return;
        _rigidbody.angularDrag = initialAngularDrag;
    }

    public override void Deactivate()
    {
        base.Deactivate();
        if (_rigidbody == null) return;
        _rigidbody.angularDrag = 0;
    }
}
